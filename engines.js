/* =====================================================================
   Moteurs de jeu : Échecs et Dames internationales (10x10)
   - aucune dépendance, aucun accès au DOM (tourne aussi dans un Web Worker)
   - IA : negamax + élagage alpha-beta, approfondissement itératif,
     recherche de quiescence, tri des coups
   ===================================================================== */

const MATE = 100000;

/* ============================== ÉCHECS ============================== */
const Chess = (() => {
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const WK = 1, WQ = 2, BK = 4, BQ = 8;
  const F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4;
  const N_OFF = [33, 31, 18, 14, -33, -31, -18, -14];
  const B_OFF = [15, 17, -15, -17];
  const R_OFF = [1, -1, 16, -16];
  const K_OFF = [1, -1, 16, -16, 15, 17, -15, -17];
  const VALUE = [0, 100, 320, 330, 500, 900, 0];
  const LETTER = ['', '', 'N', 'B', 'R', 'Q', 'K'];
  const FILES = 'abcdefgh';

  // Tables pièce-case (point de vue des Blancs, rangée 8 en premier)
  const PST = [null,
    [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
     0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
     -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
     -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
     -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
     0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  ];
  const K_MID = [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10,
    20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20];
  const K_END = [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30,
    -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30,
    -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50];

  const CASTLE_MASK = new Int8Array(128).fill(15);
  CASTLE_MASK[0] = 15 & ~WQ; CASTLE_MASK[7] = 15 & ~WK; CASTLE_MASK[4] = 15 & ~(WK | WQ);
  CASTLE_MASK[112] = 15 & ~BQ; CASTLE_MASK[119] = 15 & ~BK; CASTLE_MASK[116] = 15 & ~(BK | BQ);

  const mk = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);
  const mFrom = m => m & 127, mTo = m => (m >> 7) & 127, mPromo = m => (m >> 14) & 7, mFlags = m => (m >> 17) & 7;

  const sqName = s => FILES[s & 7] + ((s >> 4) + 1);
  const parseSq = n => {
    if (!n || n.length !== 2) return -1;
    const f = n.charCodeAt(0) - 97, r = n.charCodeAt(1) - 49;
    return (f < 0 || f > 7 || r < 0 || r > 7) ? -1 : r * 16 + f;
  };

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function fromFEN(fen) {
    const p = { b: new Int8Array(128), side: 1, castle: 0, ep: -1, half: 0, full: 1, wk: -1, bk: -1, stack: [] };
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    for (let i = 0; i < 8; i++) {
      let f = 0; const r = 7 - i;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
        const c = ch === ch.toUpperCase() ? 1 : -1;
        const s = r * 16 + f;
        p.b[s] = t * c;
        if (t === K) { if (c === 1) p.wk = s; else p.bk = s; }
        f++;
      }
    }
    p.side = parts[1] === 'b' ? -1 : 1;
    const cr = parts[2] || '-';
    if (cr.includes('K')) p.castle |= WK; if (cr.includes('Q')) p.castle |= WQ;
    if (cr.includes('k')) p.castle |= BK; if (cr.includes('q')) p.castle |= BQ;
    p.ep = parts[3] && parts[3] !== '-' ? parseSq(parts[3]) : -1;
    p.half = +(parts[4] || 0); p.full = +(parts[5] || 1);
    return p;
  }

  function toFEN(p, withCounters = true) {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let e = 0;
      for (let f = 0; f < 8; f++) {
        const x = p.b[r * 16 + f];
        if (!x) { e++; continue; }
        if (e) { s += e; e = 0; }
        const ch = 'pnbrqk'[Math.abs(x) - 1];
        s += x > 0 ? ch.toUpperCase() : ch;
      }
      if (e) s += e;
      if (r) s += '/';
    }
    let cr = '';
    if (p.castle & WK) cr += 'K'; if (p.castle & WQ) cr += 'Q';
    if (p.castle & BK) cr += 'k'; if (p.castle & BQ) cr += 'q';
    s += ' ' + (p.side === 1 ? 'w' : 'b') + ' ' + (cr || '-') + ' ' + (p.ep >= 0 ? sqName(p.ep) : '-');
    if (withCounters) s += ' ' + p.half + ' ' + p.full;
    return s;
  }

  function attacked(p, sq, by) {
    const b = p.b;
    let s;
    if (by === 1) {
      s = sq - 15; if (!(s & 0x88) && b[s] === P) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === P) return true;
    } else {
      s = sq + 15; if (!(s & 0x88) && b[s] === -P) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === -P) return true;
    }
    for (let i = 0; i < 8; i++) { s = sq + N_OFF[i]; if (!(s & 0x88) && b[s] === N * by) return true; }
    for (let i = 0; i < 8; i++) { s = sq + K_OFF[i]; if (!(s & 0x88) && b[s] === K * by) return true; }
    for (let i = 0; i < 4; i++) {
      const o = B_OFF[i]; s = sq + o;
      while (!(s & 0x88)) { const x = b[s]; if (x) { if (x === B * by || x === Q * by) return true; break; } s += o; }
    }
    for (let i = 0; i < 4; i++) {
      const o = R_OFF[i]; s = sq + o;
      while (!(s & 0x88)) { const x = b[s]; if (x) { if (x === R * by || x === Q * by) return true; break; } s += o; }
    }
    return false;
  }

  const inCheck = (p, side) => attacked(p, side === 1 ? p.wk : p.bk, -side);
  // après make() : le camp qui vient de jouer a-t-il laissé son roi en prise ?
  const leftInCheck = p => attacked(p, p.side === 1 ? p.bk : p.wk, p.side);

  function gen(p, capsOnly) {
    const moves = [], b = p.b, us = p.side;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const x = b[s];
      if (!x || (x > 0) !== (us > 0)) continue;
      const t = x * us;
      if (t === P) {
        const dir = 16 * us, startRank = us === 1 ? 1 : 6, promoRank = us === 1 ? 7 : 0;
        const to = s + dir;
        if (!(to & 0x88) && !b[to]) {
          if ((to >> 4) === promoRank) {
            moves.push(mk(s, to, Q, 0));
            if (!capsOnly) { moves.push(mk(s, to, R, 0)); moves.push(mk(s, to, B, 0)); moves.push(mk(s, to, N, 0)); }
          } else if (!capsOnly) {
            moves.push(mk(s, to, 0, 0));
            const to2 = to + dir;
            if ((s >> 4) === startRank && !b[to2]) moves.push(mk(s, to2, 0, F_DOUBLE));
          }
        }
        for (const d of [dir - 1, dir + 1]) {
          const c = s + d;
          if (c & 0x88) continue;
          if (b[c] && (b[c] > 0) !== (us > 0)) {
            if ((c >> 4) === promoRank) {
              moves.push(mk(s, c, Q, 0));
              if (!capsOnly) { moves.push(mk(s, c, R, 0)); moves.push(mk(s, c, B, 0)); moves.push(mk(s, c, N, 0)); }
            } else moves.push(mk(s, c, 0, 0));
          } else if (c === p.ep) moves.push(mk(s, c, 0, F_EP));
        }
      } else if (t === N || t === K) {
        const offs = t === N ? N_OFF : K_OFF;
        for (let i = 0; i < 8; i++) {
          const to = s + offs[i];
          if (to & 0x88) continue;
          const y = b[to];
          if (y && (y > 0) === (us > 0)) continue;
          if (capsOnly && !y) continue;
          moves.push(mk(s, to, 0, 0));
        }
        if (t === K && !capsOnly) {
          if (us === 1 && s === 4) {
            if ((p.castle & WK) && !b[5] && !b[6] && b[7] === R && !attacked(p, 4, -1) && !attacked(p, 5, -1) && !attacked(p, 6, -1)) moves.push(mk(4, 6, 0, F_CASTLE));
            if ((p.castle & WQ) && !b[3] && !b[2] && !b[1] && b[0] === R && !attacked(p, 4, -1) && !attacked(p, 3, -1) && !attacked(p, 2, -1)) moves.push(mk(4, 2, 0, F_CASTLE));
          } else if (us === -1 && s === 116) {
            if ((p.castle & BK) && !b[117] && !b[118] && b[119] === -R && !attacked(p, 116, 1) && !attacked(p, 117, 1) && !attacked(p, 118, 1)) moves.push(mk(116, 118, 0, F_CASTLE));
            if ((p.castle & BQ) && !b[115] && !b[114] && !b[113] && b[112] === -R && !attacked(p, 116, 1) && !attacked(p, 115, 1) && !attacked(p, 114, 1)) moves.push(mk(116, 114, 0, F_CASTLE));
          }
        }
      } else {
        const offs = t === B ? B_OFF : t === R ? R_OFF : K_OFF;
        for (let i = 0; i < offs.length; i++) {
          const o = offs[i]; let to = s + o;
          while (!(to & 0x88)) {
            const y = b[to];
            if (y) { if ((y > 0) !== (us > 0)) moves.push(mk(s, to, 0, 0)); break; }
            if (!capsOnly) moves.push(mk(s, to, 0, 0));
            to += o;
          }
        }
      }
    }
    return moves;
  }

  function make(p, m) {
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), fl = mFlags(m);
    const b = p.b, us = p.side, piece = b[from];
    let cap = b[to];
    if (fl & F_EP) { const cs = to - 16 * us; cap = b[cs]; b[cs] = 0; }
    p.stack.push(m, cap, p.castle, p.ep, p.half);
    b[to] = promo ? promo * us : piece;
    b[from] = 0;
    if (fl & F_CASTLE) {
      if (to === 6) { b[5] = b[7]; b[7] = 0; }
      else if (to === 2) { b[3] = b[0]; b[0] = 0; }
      else if (to === 118) { b[117] = b[119]; b[119] = 0; }
      else if (to === 114) { b[115] = b[112]; b[112] = 0; }
    }
    if (piece === K) p.wk = to; else if (piece === -K) p.bk = to;
    p.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    p.ep = (fl & F_DOUBLE) ? from + 16 * us : -1;
    p.half = (piece === P * us || cap) ? 0 : p.half + 1;
    if (us === -1) p.full++;
    p.side = -us;
  }

  function unmake(p) {
    const st = p.stack;
    const half = st.pop(), ep = st.pop(), castle = st.pop(), cap = st.pop(), m = st.pop();
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), fl = mFlags(m);
    p.side = -p.side;
    const us = p.side, b = p.b;
    const piece = promo ? P * us : b[to];
    b[from] = piece;
    if (fl & F_EP) { b[to] = 0; b[to - 16 * us] = cap; } else b[to] = cap;
    if (fl & F_CASTLE) {
      if (to === 6) { b[7] = b[5]; b[5] = 0; }
      else if (to === 2) { b[0] = b[3]; b[3] = 0; }
      else if (to === 118) { b[119] = b[117]; b[117] = 0; }
      else if (to === 114) { b[112] = b[115]; b[115] = 0; }
    }
    if (piece === K) p.wk = from; else if (piece === -K) p.bk = from;
    p.castle = castle; p.ep = ep; p.half = half;
    if (us === -1) p.full--;
  }

  function legal(p) {
    const out = [];
    for (const m of gen(p, false)) { make(p, m); if (!leftInCheck(p)) out.push(m); unmake(p); }
    return out;
  }

  function perft(p, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of gen(p, false)) {
      make(p, m);
      if (!leftInCheck(p)) n += d === 1 ? 1 : perft(p, d - 1);
      unmake(p);
    }
    return n;
  }

  // Notation algébrique standard (anglaise : N B R Q K)
  function san(p, m, list) {
    const from = mFrom(m), to = mTo(m), promo = mPromo(m), fl = mFlags(m);
    const piece = p.b[from], t = Math.abs(piece);
    let s;
    if (fl & F_CASTLE) s = (to & 7) === 6 ? 'O-O' : 'O-O-O';
    else {
      const cap = p.b[to] || (fl & F_EP);
      if (t === P) {
        s = (cap ? FILES[from & 7] + 'x' : '') + sqName(to);
        if (promo) s += '=' + LETTER[promo];
      } else {
        s = LETTER[t];
        const others = (list || legal(p)).filter(o => o !== m && mTo(o) === to && p.b[mFrom(o)] === piece);
        if (others.length) {
          const sameFile = others.some(o => (mFrom(o) & 7) === (from & 7));
          const sameRank = others.some(o => (mFrom(o) >> 4) === (from >> 4));
          if (!sameFile) s += FILES[from & 7];
          else if (!sameRank) s += (from >> 4) + 1;
          else s += sqName(from);
        }
        if (cap) s += 'x';
        s += sqName(to);
      }
    }
    make(p, m);
    if (inCheck(p, p.side)) s += legal(p).length ? '+' : '#';
    unmake(p);
    return s;
  }

  function evaluate(p) {
    const b = p.b;
    let nonPawn = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const x = b[s]; if (!x) continue;
      const t = x < 0 ? -x : x;
      if (t >= N && t <= Q) nonPawn += VALUE[t];
    }
    const kt = nonPawn <= 1300 ? K_END : K_MID;
    let score = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const x = b[s]; if (!x) continue;
      const t = x < 0 ? -x : x, r = s >> 4, f = s & 7;
      const i = x > 0 ? (7 - r) * 8 + f : r * 8 + f;
      const v = VALUE[t] + (t === K ? kt[i] : PST[t][i]);
      score += x > 0 ? v : -v;
    }
    return score * p.side;
  }

  // Matériel insuffisant pour mater (R contre R, R+F ou R+C contre R)
  function insufficient(p) {
    let minors = 0;
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      const t = Math.abs(p.b[s]);
      if (t === P || t === R || t === Q) return false;
      if (t === N || t === B) minors++;
    }
    return minors <= 1;
  }

  function search(p, opts) {
    const t0 = Date.now(), deadline = t0 + (opts.timeMs || 2000);
    let nodes = 0, stop = false;
    const killers = [];

    function scoreMove(m, ply, pv) {
      if (m === pv) return 1e7;
      const victim = p.b[mTo(m)], promo = mPromo(m);
      let s = 0;
      if (victim) s = 1e6 + 10 * VALUE[Math.abs(victim)] - VALUE[Math.abs(p.b[mFrom(m)])];
      else if (mFlags(m) & F_EP) s = 1e6 + 900;
      if (promo) s += 8e5 + VALUE[promo];
      if (!s && killers[ply] && (killers[ply][0] === m || killers[ply][1] === m)) s = 5e5;
      return s;
    }
    function ordered(ms, ply, pv) {
      const sc = ms.map(m => scoreMove(m, ply, pv));
      const idx = ms.map((_, i) => i).sort((a, b) => sc[b] - sc[a]);
      return idx.map(i => ms[i]);
    }
    function tick() { if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true; }

    function qs(alpha, beta, ply) {
      tick(); if (stop) return 0;
      const stand = evaluate(p);
      if (stand >= beta) return beta;
      if (stand > alpha) alpha = stand;
      if (ply > 60) return alpha;
      for (const m of ordered(gen(p, true), ply, 0)) {
        make(p, m);
        if (leftInCheck(p)) { unmake(p); continue; }
        const sc = -qs(-beta, -alpha, ply + 1);
        unmake(p);
        if (stop) return 0;
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
      }
      return alpha;
    }

    function ab(depth, alpha, beta, ply) {
      const chk = inCheck(p, p.side);
      if (chk) depth++;
      if (depth <= 0) return qs(alpha, beta, ply);
      tick(); if (stop) return 0;
      if (p.half >= 100) return 0;
      let n = 0;
      for (const m of ordered(gen(p, false), ply, 0)) {
        make(p, m);
        if (leftInCheck(p)) { unmake(p); continue; }
        n++;
        const sc = -ab(depth - 1, -beta, -alpha, ply + 1);
        unmake(p);
        if (stop) return 0;
        if (sc >= beta) {
          if (!p.b[mTo(m)]) { const k = killers[ply] || (killers[ply] = [0, 0]); if (k[0] !== m) { k[1] = k[0]; k[0] = m; } }
          return beta;
        }
        if (sc > alpha) alpha = sc;
      }
      if (!n) return chk ? -MATE + ply : 0;
      return alpha;
    }

    const rootMoves = legal(p);
    if (!rootMoves.length) return null;
    const noise = opts.noise || 0;
    let best = rootMoves[0], bestScore = -Infinity, reached = 0;

    if (noise > 0) {
      // Niveaux faibles : on note chaque coup (fenêtre pleine) puis on tire au sort parmi les bons
      const d = opts.maxDepth || 2;
      const scored = [];
      for (const m of rootMoves) {
        make(p, m);
        scored.push([m, -ab(d - 1, -MATE - 1, MATE + 1, 1)]);
        unmake(p);
      }
      const top = Math.max(...scored.map(x => x[1]));
      const pool = scored.filter(x => x[1] >= top - noise);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      best = pick[0]; bestScore = pick[1]; reached = d;
    } else {
      for (let d = 1; d <= (opts.maxDepth || 64); d++) {
        let alpha = -MATE - 1, iterBest = 0;
        for (const m of ordered(rootMoves, 0, best)) {
          make(p, m);
          const sc = -ab(d - 1, -MATE - 1, -alpha, 1);
          unmake(p);
          if (stop) break;
          if (sc > alpha) { alpha = sc; iterBest = m; }
        }
        if (stop) {
          // itération incomplète : on garde son meilleur coup seulement s'il bat le précédent
          if (iterBest && alpha > bestScore) { best = iterBest; bestScore = alpha; }
          break;
        }
        best = iterBest; bestScore = alpha; reached = d;
        if (Math.abs(alpha) > MATE - 100) break;
        if (Date.now() - t0 > (opts.timeMs || 2000) * 0.45) break;
      }
    }
    return { move: best, score: bestScore * p.side, depth: reached, nodes, ms: Date.now() - t0 };
  }

  return { START, fromFEN, toFEN, legal, make, unmake, san, perft, search, inCheck, insufficient, evaluate,
    mFrom, mTo, mPromo, mFlags, sqName, parseSq, F_CASTLE, F_EP, P, N, B, R, Q, K };
})();

/* ======================= DAMES INTERNATIONALES ======================= */
const Dames = (() => {
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const inside = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10;

  // Numérotation officielle : cases foncées 1 à 50, de gauche à droite, depuis le haut
  const num = i => ((i / 10) | 0) * 5 + ((i % 10) >> 1) + 1;
  const idx = n => { const r = ((n - 1) / 5) | 0, k = (n - 1) % 5; return r * 10 + (r % 2 === 0 ? 2 * k + 1 : 2 * k); };

  function initial() {
    const b = new Int8Array(100);
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
      if ((r + c) % 2 === 1) { if (r < 4) b[r * 10 + c] = -1; else if (r > 5) b[r * 10 + c] = 1; }
    }
    return { b, side: 1, stack: [] };
  }

  // Toutes les rafles possibles d'une pièce (prises en avant et en arrière, dame volante,
  // pièces prises retirées seulement à la fin : on ne peut pas les sauter deux fois)
  function capturesFrom(b, s, piece, side, out) {
    const king = Math.abs(piece) === 2;
    b[s] = 0;
    const caps = [], path = [];
    (function dfs(cur) {
      const r0 = (cur / 10) | 0, c0 = cur % 10;
      let extended = false;
      for (const [dr, dc] of DIRS) {
        if (!king) {
          const r1 = r0 + dr, c1 = c0 + dc, r2 = r1 + dr, c2 = c1 + dc;
          if (!inside(r2, c2)) continue;
          const mid = r1 * 10 + c1, land = r2 * 10 + c2;
          if (b[mid] * side < 0 && !caps.includes(mid) && b[land] === 0) {
            caps.push(mid); path.push(land); extended = true;
            dfs(land);
            caps.pop(); path.pop();
          }
        } else {
          let r = r0 + dr, c = c0 + dc;
          while (inside(r, c) && b[r * 10 + c] === 0) { r += dr; c += dc; }
          if (!inside(r, c)) continue;
          const mid = r * 10 + c;
          if (b[mid] * side < 0 && !caps.includes(mid)) {
            let lr = r + dr, lc = c + dc;
            while (inside(lr, lc) && b[lr * 10 + lc] === 0) {
              const land = lr * 10 + lc;
              caps.push(mid); path.push(land); extended = true;
              dfs(land);
              caps.pop(); path.pop();
              lr += dr; lc += dc;
            }
          }
        }
      }
      if (!extended && caps.length) out.push({ from: s, to: cur, path: path.slice(), caps: caps.slice(), promo: false });
    })(s);
    b[s] = piece;
  }

  // Coups légaux : prise obligatoire et prise majoritaire (le plus grand nombre de pièces)
  function gen(pos) {
    const b = pos.b, side = pos.side, lastRow = side === 1 ? 0 : 9;
    let caps = [];
    for (let i = 0; i < 100; i++) if (b[i] * side > 0) capturesFrom(b, i, b[i], side, caps);
    if (caps.length) {
      const max = Math.max(...caps.map(m => m.caps.length));
      caps = caps.filter(m => m.caps.length === max);
      for (const m of caps) m.promo = Math.abs(b[m.from]) === 1 && ((m.to / 10) | 0) === lastRow;
      return { moves: caps, capture: true };
    }
    const moves = [];
    for (let i = 0; i < 100; i++) {
      const x = b[i];
      if (x * side <= 0) continue;
      const r0 = (i / 10) | 0, c0 = i % 10;
      if (Math.abs(x) === 1) {
        const dr = side === 1 ? -1 : 1;
        for (const dc of [-1, 1]) {
          const r = r0 + dr, c = c0 + dc;
          if (inside(r, c) && b[r * 10 + c] === 0) moves.push({ from: i, to: r * 10 + c, path: [r * 10 + c], caps: [], promo: r === lastRow });
        }
      } else {
        for (const [dr, dc] of DIRS) {
          let r = r0 + dr, c = c0 + dc;
          while (inside(r, c) && b[r * 10 + c] === 0) {
            moves.push({ from: i, to: r * 10 + c, path: [r * 10 + c], caps: [], promo: false });
            r += dr; c += dc;
          }
        }
      }
    }
    return { moves, capture: false };
  }

  function make(pos, m) {
    const b = pos.b, piece = b[m.from];
    const capVals = m.caps.map(c => b[c]);
    pos.stack.push({ m, piece, capVals });
    b[m.from] = 0;
    for (const c of m.caps) b[c] = 0;
    b[m.to] = m.promo ? 2 * pos.side : piece;
    pos.side = -pos.side;
  }

  function unmake(pos) {
    const { m, piece, capVals } = pos.stack.pop();
    pos.side = -pos.side;
    const b = pos.b;
    b[m.to] = 0;
    m.caps.forEach((c, k) => { b[c] = capVals[k]; });
    b[m.from] = piece;
  }

  function perft(pos, d) {
    if (d === 0) return 1;
    const { moves } = gen(pos);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) { make(pos, m); n += perft(pos, d - 1); unmake(pos); }
    return n;
  }

  // Notation : 32-28 pour un déplacement, 19x28 pour une prise (chemin complet si ambigu)
  function notation(m, list) {
    const sep = m.caps.length ? 'x' : '-';
    const short = num(m.from) + sep + num(m.to);
    const key = m.path.join();
    const twin = (list || []).some(o => o.from === m.from && o.to === m.to && o.caps.length === m.caps.length && o.path.join() !== key);
    if (!twin) return short;
    return [m.from, ...m.path].map(num).join('x');
  }

  function evaluate(pos) {
    const b = pos.b;
    let s = 0;
    for (let i = 0; i < 100; i++) {
      const x = b[i]; if (!x) continue;
      const r = (i / 10) | 0, c = i % 10;
      const center = (c >= 3 && c <= 6 && r >= 3 && r <= 6) ? 6 : 0;
      let v;
      if (x === 1) v = 100 + (9 - r) * 4 + (r === 9 ? 6 : 0) + center;
      else if (x === -1) v = 100 + r * 4 + (r === 0 ? 6 : 0) + center;
      else v = 320;
      s += x > 0 ? v : -v;
    }
    return s * pos.side;
  }

  function search(pos, opts) {
    const t0 = Date.now(), deadline = t0 + (opts.timeMs || 2000);
    let nodes = 0, stop = false;
    const tick = () => { if ((++nodes & 1023) === 0 && Date.now() > deadline) stop = true; };
    const order = (ms, pv) => ms.slice().sort((a, b) =>
      ((b === pv) - (a === pv)) * 1e6 + (b.promo - a.promo) * 1e3 + (b.caps.length - a.caps.length));

    function ab(depth, alpha, beta, ply) {
      tick(); if (stop) return 0;
      const { moves, capture } = gen(pos);
      if (!moves.length) return -MATE + ply;
      // prise en cours : on prolonge la recherche (quiescence), sinon évaluation
      if (depth <= 0 && (!capture || ply > 40)) return evaluate(pos);
      for (const m of order(moves, null)) {
        make(pos, m);
        const sc = -ab(depth - 1, -beta, -alpha, ply + 1);
        unmake(pos);
        if (stop) return 0;
        if (sc >= beta) return beta;
        if (sc > alpha) alpha = sc;
      }
      return alpha;
    }

    const rootMoves = gen(pos).moves;
    if (!rootMoves.length) return null;
    const noise = opts.noise || 0;
    let best = rootMoves[0], bestScore = -Infinity, reached = 0;

    if (rootMoves.length === 1) {
      best = rootMoves[0];
      make(pos, best); bestScore = -evaluate(pos); unmake(pos);
    } else if (noise > 0) {
      const d = opts.maxDepth || 2;
      const scored = rootMoves.map(m => { make(pos, m); const sc = -ab(d - 1, -MATE - 1, MATE + 1, 1); unmake(pos); return [m, sc]; });
      const top = Math.max(...scored.map(x => x[1]));
      const pool = scored.filter(x => x[1] >= top - noise);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      best = pick[0]; bestScore = pick[1]; reached = d;
    } else {
      for (let d = 1; d <= (opts.maxDepth || 64); d++) {
        let alpha = -MATE - 1, iterBest = null;
        for (const m of order(rootMoves, best)) {
          make(pos, m);
          const sc = -ab(d - 1, -MATE - 1, -alpha, 1);
          unmake(pos);
          if (stop) break;
          if (sc > alpha) { alpha = sc; iterBest = m; }
        }
        if (stop) { if (iterBest && alpha > bestScore) { best = iterBest; bestScore = alpha; } break; }
        best = iterBest; bestScore = alpha; reached = d;
        if (Math.abs(alpha) > MATE - 100) break;
        if (Date.now() - t0 > (opts.timeMs || 2000) * 0.45) break;
      }
    }
    return { move: best, score: bestScore * pos.side, depth: reached, nodes, ms: Date.now() - t0 };
  }

  return { initial, gen, make, unmake, perft, notation, evaluate, search, num, idx };
})();

/* Niveaux de l'IA (profondeur en demi-coups, temps max, tolérance aléatoire) */
const LEVELS = {
  chess: { debutant: { maxDepth: 2, timeMs: 1500, noise: 120 }, club: { maxDepth: 3, timeMs: 2000, noise: 25 }, fort: { maxDepth: 64, timeMs: 2500, noise: 0 } },
  dames: { debutant: { maxDepth: 2, timeMs: 1500, noise: 60 }, club: { maxDepth: 4, timeMs: 2000, noise: 12 }, fort: { maxDepth: 64, timeMs: 2500, noise: 0 } },
};

/* Point d'entrée commun : page (secours) et Web Worker. Les données reçues sont
   revalidées : niveau inconnu -> "club", plateau reconstruit depuis des nombres. */
function aiCompute(d) {
  const level = Object.prototype.hasOwnProperty.call(LEVELS.chess, d.level) ? d.level : 'club';
  if (d.game === 'chess') {
    const p = Chess.fromFEN(String(d.fen));
    const r = Chess.search(p, LEVELS.chess[level]);
    return r ? { id: d.id, game: 'chess', move: r.move, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms } : { id: d.id, game: 'chess', move: null };
  }
  const pos = { b: Int8Array.from(d.board), side: d.side === -1 ? -1 : 1, stack: [] };
  const r = Dames.search(pos, LEVELS.dames[level]);
  return r ? { id: d.id, game: 'dames', move: { from: r.move.from, path: r.move.path }, score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms } : { id: d.id, game: 'dames', move: null };
}

if (typeof document === 'undefined' && typeof self !== 'undefined' && typeof postMessage === 'function') {
  self.onmessage = e => self.postMessage(aiCompute(e.data));
}
