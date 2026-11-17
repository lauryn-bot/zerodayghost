/* ui.js : interface « Opération Kriegspiel » (clics sur le plateau, saisie des ordres, brouillard,
   journal des opérations, compte rendu d'incident, appel de l'IA).
   S'appuie sur Chess, Dames, LEVELS et aiCompute (engines.js) et sur Ops (ops.js). */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  const FR = { K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' };
  const toFr = san => san.replace(/[KQRBN]/g, ch => FR[ch]);
  const fmtInt = n => n.toLocaleString('fr-FR');
  const fmtDec = (x, d) => x.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const GLYPH = { 1: '♟︎', 2: '♞︎', 3: '♝︎', 4: '♜︎', 5: '♛︎', 6: '♚︎' };
  const LEVEL_LABEL = { debutant: 'Faible', club: 'Modérée', fort: 'Élevée' };
  const THEATRE = { chess: 'Échecs · Brouillard de guerre', dames: 'Dames · Cyber Kill Chain' };
  const MIN_THINK_MS = 450;

  /* ---------------- IA : un Web Worker par jeu, secours sur la page ---------------- */
  const workers = { chess: null, dames: null };
  const pending = { chess: 0, dames: 0 };
  let reqId = 0;

  // Le Worker charge engines.js dans un fil séparé : la page reste fluide pendant que l'IA calcule.
  // Si le navigateur le refuse (page ouverte en file://), l'IA calcule dans la page (secours).
  function makeWorker() {
    try { return new Worker('engines.js'); } catch (e) { return null; }
  }

  function runAI(game, payload, cb) {
    const id = ++reqId;
    pending[game] = id;
    const fallback = () => setTimeout(() => {
      if (pending[game] !== id) return;
      cb(aiCompute({ ...payload, id, game }));
    }, 30);
    let w = workers[game];
    if (w === null) w = workers[game] = makeWorker() || false;
    if (!w) { fallback(); return; }
    w.onmessage = e => { if (e.data && e.data.id === pending[game]) cb(e.data); };
    w.onerror = ev => { ev.preventDefault(); w.terminate(); workers[game] = false; fallback(); };
    w.postMessage({ ...payload, id, game });
  }

  function cancelAI(game) {
    pending[game] = 0;
    if (workers[game]) { workers[game].terminate(); workers[game] = null; }
  }

  /* ---------------- État ---------------- */
  let tab = 'chess';
  const C = { pos: null, human: 1, level: 'club', hist: [], keys: [], over: null, sel: -1, legal: [], check: false, thinking: false, last: null, info: null, promo: null, pulse: -1, reported: false };
  const D = { pos: null, human: 1, level: 'club', hist: [], keys: [], over: null, sel: -1, cands: [], partial: [], legal: [], capture: false, thinking: false, last: null, info: null, pulse: -1, reported: false };
  const G = () => (tab === 'chess' ? C : D);

  const moverOf = i => (i % 2 === 0 ? 1 : -1); // les Blancs commencent dans les deux jeux
  const humanMoves = S => S.hist.some((_, i) => moverOf(i) === S.human);
  const humanTurn = S => !S.over && !S.thinking && S.pos.side === S.human && !(S === C && C.promo);
  const isBlue = (S, x) => x !== 0 && (x > 0) === (S.human > 0);
  const turnOf = i => Math.floor(i / 2) + 1;

  /* ================================ ÉCHECS ================================ */
  const chessKey = p => Chess.toFEN(p, false);

  function chessNew(human) {
    cancelAI('chess');
    Object.assign(C, { pos: Chess.fromFEN(Chess.START), human, hist: [], over: null, sel: -1, thinking: false, last: null, info: null, promo: null, pulse: -1, reported: false });
    C.keys = [chessKey(C.pos)];
    chessRefresh();
    if (C.pos.side !== C.human) chessAI();
  }

  function chessRefresh() {
    C.legal = Chess.legal(C.pos);
    C.check = Chess.inCheck(C.pos, C.pos.side);
    C.over = chessEnd();
  }

  function chessEnd() {
    const p = C.pos;
    if (!C.legal.length) return C.check ? { kind: 'mate', winner: -p.side } : { kind: 'draw', why: 'Pat : le camp au trait n’a aucun coup légal.' };
    if (p.half >= 100) return { kind: 'draw', why: '50 coups sans prise ni mouvement de pion.' };
    if (Chess.insufficient(p)) return { kind: 'draw', why: 'Matériel insuffisant pour mater.' };
    const k = C.keys[C.keys.length - 1];
    if (C.keys.filter(x => x === k).length >= 3) return { kind: 'draw', why: 'Triple répétition de la position.' };
    return null;
  }

  // Joue un coup et l'inscrit au journal, du point de vue de la Blue Team
  function chessApply(m) {
    const p = C.pos, blue = p.side === C.human;
    const from = Chess.mFrom(m), to = Chess.mTo(m), fl = Chess.mFlags(m), promo = Chess.mPromo(m);
    const piece = Math.abs(p.b[from]);
    const victim = (fl & Chess.F_EP) ? Chess.P : Math.abs(p.b[to]);
    const san = Chess.san(p, m, C.legal);
    const seenBefore = blue ? Ops.visibleEnemies(p.b, C.human) : null;
    Chess.make(p, m);
    const check = Chess.inCheck(p, p.side);
    const mate = check && Chess.legal(p).length === 0;
    let ev, contact = -1;
    if (blue) {
      let revealed = 0;
      for (const s of Ops.visibleEnemies(p.b, C.human)) if (!seenBefore.has(s)) revealed++;
      ev = Ops.chessBlueEvent({
        role: Ops.role('blue', piece), to: Chess.sqName(to), check, mate, revealed,
        castle: !!(fl & Chess.F_CASTLE),
        victimRole: victim ? Ops.role('red', victim) : null,
        promoRole: promo ? Ops.role('blue', promo) : null,
      });
      const fr = toFr(san).replace(/[+#]$/, '');
      if (fr !== Chess.sqName(to)) ev.text += ` · ${toFr(san)}`; // notation, sauf si elle répète la case
    } else {
      const cov = Ops.chessCoverage(p.b, C.human);
      ev = Ops.chessRedEvent({
        role: Ops.role('red', promo || piece), from: Chess.sqName(from), to: Chess.sqName(to),
        visibleFrom: cov.has(from), visibleTo: cov.has(to), check, mate,
        victimRole: victim ? Ops.role('blue', victim) : null,
        promoRole: promo ? Ops.role('red', promo) : null,
      });
      if (victim && !cov.has(to)) contact = to; // piste radar : on sait où, pas qui
    }
    C.hist.push({ m, san, blue, ev, victim, contact });
    C.keys.push(chessKey(p));
    C.last = { from, to };
    chessRefresh();
  }

  function chessPlay(m, byAI) {
    chessApply(m);
    C.sel = -1; C.promo = null;
    C.pulse = byAI ? Chess.mTo(m) : -1;
    render();
    if (!C.over && C.pos.side !== C.human) chessAI();
  }

  function chessAI() {
    C.thinking = true;
    render();
    const t0 = performance.now();
    runAI('chess', { fen: Chess.toFEN(C.pos), level: C.level }, res => {
      setTimeout(() => {
        if (pending.chess !== res.id) return;
        C.thinking = false;
        const m = res.move == null ? undefined : C.legal.find(x => x === res.move);
        if (m === undefined) { render(); return; }
        C.info = res;
        chessPlay(m, true);
      }, Math.max(0, MIN_THINK_MS - (performance.now() - t0)));
    });
  }

  function chessUndo() {
    if (!humanMoves(C)) return;
    cancelAI('chess');
    C.thinking = false;
    let n = C.pos.side === C.human ? 2 : 1;
    n = Math.min(n, C.hist.length);
    for (let i = 0; i < n; i++) { Chess.unmake(C.pos); C.hist.pop(); C.keys.pop(); }
    const h = C.hist[C.hist.length - 1];
    C.last = h ? { from: Chess.mFrom(h.m), to: Chess.mTo(h.m) } : null;
    Object.assign(C, { sel: -1, promo: null, info: null, pulse: -1, reported: false });
    chessRefresh();
    render();
    if (!C.over && C.pos.side !== C.human) chessAI();
  }

  function chessClick(s) {
    if (!humanTurn(C)) return;
    const x = C.pos.b[s];
    if (C.sel >= 0) {
      const ms = C.legal.filter(m => Chess.mFrom(m) === C.sel && Chess.mTo(m) === s);
      if (ms.length === 1) { chessPlay(ms[0]); return; }
      if (ms.length > 1) { C.promo = { moves: ms }; render(); return; }
    }
    const own = isBlue(C, x) && C.legal.some(m => Chess.mFrom(m) === s);
    C.sel = own && C.sel !== s ? s : -1;
    render();
  }

  function chessParse(raw) {
    const L = C.legal;
    const norm = s => s.replace(/[+#!?=\s]/g, '').replace(/0/g, 'O').replace(/^o-o(-o)?$/i, x => x.toUpperCase());
    const inp = norm(raw);
    const co = inp.toLowerCase().match(/^([a-h][1-8])[-x]?([a-h][1-8])([dtfcqrbn])?$/);
    if (co) {
      const from = Chess.parseSq(co[1]), to = Chess.parseSq(co[2]);
      const P = { d: Chess.Q, q: Chess.Q, t: Chess.R, r: Chess.R, f: Chess.B, b: Chess.B, c: Chess.N, n: Chess.N };
      let c = L.filter(m => Chess.mFrom(m) === from && Chess.mTo(m) === to);
      if (c.length > 1) c = c.filter(m => Chess.mPromo(m) === (co[3] ? P[co[3]] : Chess.Q));
      if (c.length === 1) return { m: c[0] };
    }
    const sans = L.map(m => Chess.san(C.pos, m, L));
    let hit = L.filter((m, i) => norm(toFr(sans[i])) === inp);
    if (hit.length === 1) return { m: hit[0] };
    hit = L.filter((m, i) => norm(sans[i]) === inp); // tolérance : notation anglaise
    if (hit.length === 1) return { m: hit[0] };
    return { err: `Ordre refusé par l’arbitre : « ${raw} » n’est pas possible dans cette position.` };
  }

  /* ================================ DAMES ================================ */
  const damesKey = pos => pos.b.join(',') + '|' + pos.side;
  const NO_COUNT = { kingPlies: 0, cat: null, catPlies: 0 };

  function damesNew(human) {
    cancelAI('dames');
    Object.assign(D, { pos: Dames.initial(), human, hist: [], over: null, sel: -1, cands: [], partial: [], thinking: false, last: null, info: null, pulse: -1, reported: false });
    D.keys = [damesKey(D.pos)];
    damesRefresh();
    if (D.pos.side !== D.human) damesAI();
  }

  function damesRefresh() {
    const g = Dames.gen(D.pos);
    D.legal = g.moves; D.capture = g.capture;
    D.over = damesEnd();
  }

  // Fins de partie FMJD 6.3 / 6.4 : une dame seule contre au plus trois pièces dont une dame
  function damesCat(b) {
    const s = { 1: { n: 0, k: 0 }, '-1': { n: 0, k: 0 } };
    for (const x of b) if (x) { const t = s[x > 0 ? 1 : -1]; t.n++; if (Math.abs(x) === 2) t.k++; }
    const lone = t => t.n === 1 && t.k === 1;
    const other = lone(s['-1']) && s[1].k >= 1 ? s[1] : lone(s[1]) && s['-1'].k >= 1 ? s['-1'] : null;
    if (!other) return null;
    return other.n === 3 ? '16' : other.n <= 2 ? '5' : null;
  }

  function damesEnd() {
    if (!D.legal.length) {
      const why = D.pos.side === D.human ? 'Vos forces n’ont plus aucun coup possible.' : 'L’attaquant n’a plus aucune capacité d’action.';
      return { kind: 'win', winner: -D.pos.side, why };
    }
    const c = D.hist.length ? D.hist[D.hist.length - 1].cnt : NO_COUNT;
    if (c.kingPlies >= 50) return { kind: 'draw', why: '25 coups de dames sans prise ni déplacement de pion.' };
    if (c.cat === '16' && c.catPlies >= 32) return { kind: 'draw', why: 'Fin de partie : 16 coups chacun sans conclusion.' };
    if (c.cat === '5' && c.catPlies >= 10) return { kind: 'draw', why: 'Fin de partie : 5 coups chacun sans conclusion.' };
    const k = D.keys[D.keys.length - 1];
    if (D.keys.filter(x => x === k).length >= 3) return { kind: 'draw', why: 'Triple répétition de la position.' };
    return null;
  }

  // Joue un coup, tient les compteurs de nulle et inscrit l'événement au journal
  function damesApply(m) {
    const p = D.pos, blue = p.side === D.human, red = -D.human;
    const nota = Dames.notation(m, D.legal);
    const wasKing = Math.abs(p.b[m.from]) === 2;
    const capsKing = m.caps.some(c => Math.abs(p.b[c]) === 2);
    const prevThreat = Ops.threatLevel(p.b, red);
    Dames.make(p, m);
    const prev = D.hist.length ? D.hist[D.hist.length - 1].cnt : NO_COUNT;
    const cat = damesCat(p.b);
    const cnt = {
      kingPlies: wasKing && !m.caps.length ? prev.kingPlies + 1 : 0,
      cat, catPlies: cat && cat === prev.cat ? prev.catPlies + 1 : 0,
    };
    const threat = Ops.threatLevel(p.b, red);
    let ev;
    if (blue) {
      const quiet = !m.caps.length && !m.promo;
      ev = Ops.damesBlueEvent({
        nota, caps: m.caps.length, capsKing, promo: m.promo, isKing: wasKing,
        deceive: quiet && Dames.gen(p).capture,          // l'attaquant est forcé de prendre
        isolate: quiet && Ops.damesBlocks(p.b, m.to, red), // on se place devant un implant
      });
    } else {
      ev = Ops.damesRedEvent({ nota, caps: m.caps.length, promo: m.promo, isKing: wasKing, phase: Ops.killChainPhase((m.to / 10) | 0, red), prevThreat, newThreat: threat });
    }
    D.hist.push({ m, nota, cnt, blue, ev, threat });
    D.keys.push(damesKey(p));
    D.last = { from: m.from, to: m.to, caps: m.caps.slice() };
    damesRefresh();
  }

  function damesPlay(m, byAI) {
    damesApply(m);
    D.sel = -1; D.cands = []; D.partial = [];
    D.pulse = byAI ? m.to : -1;
    render();
    if (!D.over && D.pos.side !== D.human) damesAI();
  }

  function damesAI() {
    D.thinking = true;
    render();
    const t0 = performance.now();
    runAI('dames', { board: Array.from(D.pos.b), side: D.pos.side, level: D.level }, res => {
      setTimeout(() => {
        if (pending.dames !== res.id) return;
        D.thinking = false;
        const m = res.move && D.legal.find(x => x.from === res.move.from && x.path.join() === res.move.path.join());
        if (!m) { render(); return; }
        D.info = res;
        damesPlay(m, true);
      }, Math.max(0, MIN_THINK_MS - (performance.now() - t0)));
    });
  }

  function damesUndo() {
    if (!humanMoves(D)) return;
    cancelAI('dames');
    D.thinking = false;
    let n = D.pos.side === D.human ? 2 : 1;
    n = Math.min(n, D.hist.length);
    for (let i = 0; i < n; i++) { Dames.unmake(D.pos); D.hist.pop(); D.keys.pop(); }
    const h = D.hist[D.hist.length - 1];
    D.last = h ? { from: h.m.from, to: h.m.to, caps: h.m.caps.slice() } : null;
    Object.assign(D, { sel: -1, cands: [], partial: [], info: null, pulse: -1, reported: false });
    damesRefresh();
    render();
    if (!D.over && D.pos.side !== D.human) damesAI();
  }

  function damesClick(i) {
    if (!humanTurn(D)) return;
    if (D.sel >= 0) {
      const k = D.partial.length;
      const next = D.cands.filter(m => m.path[k] === i);
      if (next.length) {
        D.cands = next; D.partial = [...D.partial, i];
        if (next.length === 1) { damesPlay(next[0]); return; }
        render(); return;
      }
      const fin = D.cands.filter(m => m.to === i);
      if (fin.length === 1) { damesPlay(fin[0]); return; }
    }
    const own = D.pos.b[i] * D.human > 0 && D.legal.some(m => m.from === i);
    if (own && !(D.sel === i && !D.partial.length)) { D.sel = i; D.cands = D.legal.filter(m => m.from === i); D.partial = []; }
    else { D.sel = -1; D.cands = []; D.partial = []; }
    render();
  }

  function damesParse(raw) {
    if (!/^\s*\d{1,2}(\s*[-x×:]\s*\d{1,2})+\s*$/i.test(raw)) return { err: 'Format attendu : 32-28 ou 19x28 (numéros de 1 à 50).' };
    const nums = raw.split(/[-x×:\s]+/i).filter(Boolean).map(Number);
    if (nums.some(n => n < 1 || n > 50)) return { err: 'Les cases sont numérotées de 1 à 50.' };
    const from = Dames.idx(nums[0]), to = Dames.idx(nums[nums.length - 1]);
    let c = D.legal.filter(m => m.from === from && m.to === to);
    if (nums.length > 2) c = c.filter(m => m.path.map(Dames.num).join() === nums.slice(1).join());
    if (c.length === 1) return { m: c[0] };
    if (c.length > 1) return { err: 'Plusieurs rafles mènent à cette case : précisez le chemin, ex. 19x28x37.' };
    if (D.capture) return { err: `Prise obligatoire : « ${raw.trim()} » n’est pas une prise majoritaire possible.` };
    return { err: `Ordre refusé par l’arbitre : « ${raw.trim()} » n’est pas possible dans cette position.` };
  }

  /* ================================ RENDU ================================ */
  const boardEl = $('board');

  function renderChessBoard() {
    boardEl.className = 'board chess';
    boardEl.setAttribute('aria-label', 'Échiquier, brouillard de guerre');
    const flip = C.human === -1;
    const over = !!C.over;
    const cov = over ? null : Ops.chessCoverage(C.pos.b, C.human);
    const seen = s => over || cov.has(s);
    const lastH = C.hist[C.hist.length - 1];
    const contact = !over && lastH && !lastH.blue ? lastH.contact : -1;
    const targets = new Map();
    if (C.sel >= 0) for (const m of C.legal) if (Chess.mFrom(m) === C.sel) {
      const t = Chess.mTo(m);
      targets.set(t, !!C.pos.b[t] || !!(Chess.mFlags(m) & Chess.F_EP));
    }
    const kingSq = C.check && C.pos.side === C.human ? (C.pos.side === 1 ? C.pos.wk : C.pos.bk) : -1;
    const frag = document.createDocumentFragment();
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const r = flip ? row : 7 - row, f = flip ? 7 - col : col, s = r * 16 + f;
      const b = el('button', 'sq ' + ((r + f) % 2 === 0 ? 'dark' : 'light'));
      b.type = 'button'; b.dataset.s = s;
      const x = C.pos.b[s], mine = isBlue(C, x), vis = seen(s);
      if (!vis) b.classList.add('fog');
      if (C.last && lastH && (lastH.blue || vis) && (s === C.last.from || s === C.last.to)) b.classList.add('last');
      if (s === C.sel) b.classList.add('sel');
      if (s === kingSq) b.classList.add('check');
      if (s === C.pulse && vis) b.classList.add('arrive');
      if (x && (mine || vis)) b.append(el('span', 'pc ' + (mine ? 'blue' : 'red'), GLYPH[Math.abs(x)]));
      else if (s === contact) b.append(el('span', 'contact', '?'));
      if (targets.has(s)) b.append(el('span', targets.get(s) ? 'ring' : 'dot'));
      if (col === 0) b.append(el('span', 'coord rank', String(r + 1)));
      if (row === 7) b.append(el('span', 'coord file', 'abcdefgh'[f]));
      let what;
      if (x && mine) what = `${Ops.role('blue', Math.abs(x))}, vos forces`;
      else if (x && vis) what = `${Ops.role('red', Math.abs(x))}, adverse`;
      else if (!vis) what = s === contact ? 'hors couverture, neutralisation signalée' : 'hors couverture';
      else what = 'vide';
      b.setAttribute('aria-label', `${Chess.sqName(s)}, ${what}${targets.has(s) ? ', destination possible' : ''}${s === C.sel ? ', sélectionnée' : ''}`);
      frag.append(b);
    }
    boardEl.replaceChildren(frag);
    C.pulse = -1;
  }

  function renderDamesBoard() {
    boardEl.className = 'board dames';
    boardEl.setAttribute('aria-label', 'Damier de 100 cases, rangées colorées selon la Cyber Kill Chain');
    const flip = D.human === -1, red = -D.human;
    const k = D.partial.length;
    const next = new Set(D.sel >= 0 ? D.cands.map(m => m.path[k]) : []);
    const taken = new Set(D.sel >= 0 && k ? D.cands[0].caps.slice(0, k) : []);
    const must = new Set(humanTurn(D) && D.capture && D.sel < 0 ? D.legal.map(m => m.from) : []);
    const gone = new Set(D.last ? D.last.caps : []);
    const frag = document.createDocumentFragment();
    for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
      const r = flip ? 9 - row : row, c = flip ? 9 - col : col, i = r * 10 + c;
      const ph = Ops.killChainPhase(r, red);
      if ((r + c) % 2 === 0) { const d = el('div', 'sq light ph-' + ph); d.setAttribute('aria-hidden', 'true'); frag.append(d); continue; }
      const b = el('button', 'sq dark');
      b.type = 'button'; b.dataset.s = i;
      const x = D.pos.b[i], n = Dames.num(i);
      b.append(el('span', 'num', String(n)));
      if (D.last && (i === D.last.from || i === D.last.to)) b.classList.add('last');
      if (i === D.sel || D.partial.includes(i)) b.classList.add('sel');
      if (must.has(i)) b.classList.add('must');
      if (taken.has(i)) b.classList.add('taken');
      if (i === D.pulse) b.classList.add('arrive');
      const mine = isBlue(D, x);
      if (x) b.append(el('span', 'man ' + (mine ? 'blue' : 'red') + (Math.abs(x) === 2 ? ' king' : '')));
      else if (gone.has(i)) b.append(el('span', 'gone'));
      if (next.has(i)) b.append(el('span', 'dot'));
      const what = x ? (mine ? (Math.abs(x) === 2 ? 'groupe d’intervention' : 'sentinelle') : (Math.abs(x) === 2 ? 'APT persistante' : 'implant')) : 'vide';
      b.setAttribute('aria-label', `case ${n}, phase ${Ops.PHASES[ph]}, ${what}${next.has(i) ? ', destination possible' : ''}${must.has(i) ? ', doit prendre' : ''}`);
      frag.append(b);
    }
    boardEl.replaceChildren(frag);
    D.pulse = -1;
  }

  function renderPromo() {
    const box = $('promo');
    if (tab !== 'chess' || !C.promo) { box.hidden = true; return; }
    const row = $('promo-row');
    row.replaceChildren();
    for (const t of [Chess.Q, Chess.R, Chess.B, Chess.N]) {
      const m = C.promo.moves.find(x => Chess.mPromo(x) === t);
      if (m === undefined) continue;
      const b = el('button');
      b.type = 'button';
      b.append(el('span', 'pc blue', GLYPH[t]), el('span', null, Ops.role('blue', t)));
      b.addEventListener('click', () => chessPlay(m));
      row.append(b);
    }
    box.hidden = false;
    row.firstChild && row.firstChild.focus();
  }

  // Évaluation de l'IA, traduite du point de vue de la Blue Team
  function evalText(S, res) {
    if (!res || res.score == null) return '';
    const sc = res.score * S.human; // res.score est donné du point de vue des Blancs
    if (Math.abs(sc) > MATE - 100) {
      const n = Math.ceil((MATE - Math.abs(sc)) / 2);
      return `${S === C ? 'mat' : 'gain forcé'} en ${n} pour ${sc > 0 ? 'vous' : 'l’attaquant'}`;
    }
    const v = Math.round(sc / 10) / 10;
    if (v === 0) return 'rapport de forces équilibré';
    return `avantage ${v > 0 ? 'Blue' : 'Red'} ${fmtDec(Math.abs(v), 1)} pion${Math.abs(v) >= 2 ? 's' : ''}`;
  }

  function resultOf(S) {
    if (!S.over) return null;
    if (S.over.kind === 'draw') return { title: 'Situation figée', why: S.over.why, cls: 'draw' };
    const win = S.over.winner === S.human;
    if (S === C) {
      return win
        ? { title: 'Mission accomplie', why: 'Le serveur C2 adverse est neutralisé (échec et mat).', cls: 'win' }
        : { title: 'Mission échouée', why: 'Votre poste de commandement est compromis (échec et mat).', cls: 'loss' };
    }
    return win ? { title: 'Mission accomplie', why: S.over.why, cls: 'win' } : { title: 'Mission échouée', why: S.over.why, cls: 'loss' };
  }

  function renderGauge(S) {
    const text = $('gauge-text'), bar = $('gauge-bar');
    bar.replaceChildren();
    if (S === C) {
      bar.className = 'gauge-bar meter';
      if (C.over) { text.textContent = 'Brouillard levé : tout le théâtre est visible.'; return; }
      const cov = Ops.chessCoverage(C.pos.b, C.human);
      const seen = Ops.visibleEnemies(C.pos.b, C.human, cov).size;
      let reds = 0;
      for (let s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } if (C.pos.b[s] && !isBlue(C, C.pos.b[s])) reds++; }
      text.textContent = `Couverture de détection : ${cov.size}/64 cases · menaces localisées : ${seen} sur ${reds}`;
      const fill = el('span');
      fill.style.width = `${Math.round(cov.size / 64 * 100)}%`; // CSSOM : autorisé par la CSP
      bar.append(fill);
    } else {
      bar.className = 'gauge-bar chain';
      const h = D.hist[D.hist.length - 1];
      const t = h ? h.threat : Ops.threatLevel(D.pos.b, -D.human);
      text.textContent = t >= 0 ? `Niveau d’alerte : phase ${t + 1}/7 · ${Ops.PHASES[t]}` : 'Niveau d’alerte : aucune menace active';
      for (let k = 0; k < 7; k++) bar.append(el('span', k <= t ? 'on ph-' + k : null));
    }
  }

  function renderJournal(S) {
    const list = $('journal');
    list.replaceChildren();
    const brief = el('li', 'ev sys');
    brief.append(el('span', 'ev-t', 'T0'), el('span', 'ev-tag', 'Briefing'),
      el('span', 'ev-txt', S === C
        ? 'Défendez votre poste de commandement. L’attaquant a fini sa reconnaissance et voit tout ; vous ne voyez que votre zone de couverture.'
        : 'Empêchez les implants de traverser les 7 phases de la Kill Chain. Une promotion adverse signale une compromission.'));
    list.append(brief);
    S.hist.forEach((h, i) => list.append(eventItem(turnOf(i), h.ev)));
    if (S.thinking) {
      const li = el('li', 'ev red pending');
      li.append(el('span', 'ev-t', 'T' + turnOf(S.hist.length)), el('span', 'ev-tag', 'Red'), el('span', 'ev-txt', 'L’attaquant manœuvre…'));
      list.append(li);
    }
    const sc = $('journal-scroll'); sc.scrollTop = sc.scrollHeight;
  }

  function eventItem(turn, ev) {
    const li = el('li', 'ev ' + ev.team + (ev.alert ? ' alert' : ''));
    const tag = ev.team === 'blue' ? Ops.TACTICS[ev.tactic].fr : (ev.alert ? 'Alerte' : 'Red');
    li.append(el('span', 'ev-t', 'T' + turn), el('span', 'ev-tag' + (ev.tactic ? ' tac-' + ev.tactic : ''), tag), el('span', 'ev-txt', ev.text));
    return li;
  }

  function renderLegend(S) {
    const box = $('legend');
    box.replaceChildren();
    if (S === C) {
      $('legend-title').textContent = 'Ordre de bataille';
      const table = el('table', 'orbat');
      const head = el('tr');
      head.append(el('th', null, 'Pièce'), el('th', null, 'Blue Team (vous)'), el('th', null, 'Red Team'));
      const thead = el('thead'); thead.append(head);
      const tbody = el('tbody');
      for (const t of [6, 5, 4, 3, 2, 1]) {
        const tr = el('tr');
        const g = el('td', 'g');
        g.append(el('span', 'pc blue', GLYPH[t]), el('span', 'pc red', GLYPH[t]));
        tr.append(g, el('td', null, Ops.role('blue', t)), el('td', null, Ops.role('red', t)));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      box.append(table);
    } else {
      $('legend-title').textContent = 'Cyber Kill Chain';
      const h = D.hist[D.hist.length - 1];
      const t = h ? h.threat : Ops.threatLevel(D.pos.b, -D.human);
      const ol = el('ol', 'kc');
      Ops.PHASES.forEach((name, k) => {
        const li = el('li', 'ph-' + k + (k === t ? ' cur' : k < t ? ' done' : ''));
        li.append(el('span', 'sw'), el('span', null, name));
        ol.append(li);
      });
      box.append(ol, el('p', 'hint', 'Phases vues depuis l’attaquant : ses 4 rangées de départ correspondent à la reconnaissance, puis chaque rangée franchie vers votre camp à une nouvelle phase.'));
    }
  }

  function renderPanel() {
    const S = G();
    document.body.dataset.game = tab;
    for (const [id, t] of [['tab-chess', 'chess'], ['tab-dames', 'dames']]) {
      if (tab === t) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
    }
    $('board-mode').textContent = S === C
      ? (C.over ? 'brouillard levé' : 'brouillard de guerre actif')
      : 'rangées = phases de la Kill Chain';

    // Situation
    const card = $('status-card');
    card.className = 'card status';
    let main, sub;
    const res = resultOf(S);
    if (res) {
      card.classList.add('over', res.cls);
      main = res.title; sub = res.why;
    } else if (S.thinking) {
      card.classList.add('turn-ai');
      main = 'L’attaquant manœuvre';
      sub = `Niveau de menace : ${LEVEL_LABEL[S.level]}.`;
    } else {
      main = 'Vos ordres';
      const h = S.hist[S.hist.length - 1];
      if (S === C) {
        sub = '';
        if (h && !h.blue) {
          sub = `Arbitre : ${h.ev.text}.`;
          if (h.victim) {
            const sq = Chess.sqName(Chess.mTo(h.m));
            sub += ` Sur l’échiquier réel, retirez votre ${Ops.role('blue', h.victim)} en ${sq}.`;
          }
        }
        if (C.check) sub += ' Votre poste de commandement est en échec : parez la menace.';
        if (!sub) sub = 'Déployez vos forces pour étendre votre couverture de détection.';
      } else {
        sub = '';
        if (h && !h.blue) {
          sub = `L’attaquant a joué ${h.nota}` + (h.m.caps.length ? ` : retirez ${h.m.caps.length > 1 ? 'les ' + h.m.caps.length + ' pièces marquées' : 'la pièce marquée'}.` : '.');
        }
        if (D.capture) {
          const n = D.legal[0].caps.length;
          sub += ` Prise obligatoire : ${n > 1 ? 'rafle de ' + n + ' pièces' : '1 pièce'}.`;
        }
        if (!sub) sub = 'Tenez vos lignes : chaque rangée franchie fait avancer l’attaquant dans la Kill Chain.';
      }
    }
    $('status-main').textContent = main;
    $('status-sub').textContent = sub.trim();
    $('thinking').hidden = !S.thinking;
    $('open-report').hidden = !S.over;
    renderGauge(S);

    // Réglages
    const lv = document.querySelector(`input[name="level"][value="${S.level}"]`);
    if (lv) lv.checked = true;
    $('undo').disabled = !humanMoves(S);
    $('manual-input').placeholder = S === C ? 'Cf3' : '32-28';
    $('manual-submit').disabled = !humanTurn(S);

    renderJournal(S);
    renderLegend(S);

    // Renseignement sur le dernier calcul de l'IA
    const r = S.info;
    $('ai-info').textContent = r && r.depth === 0
      ? 'Renseignement · coup forcé : l’attaquant n’avait qu’un seul coup possible.'
      : r && r.depth != null
      ? `Renseignement · l’attaquant a calculé à la profondeur ${r.depth} : ${fmtInt(r.nodes)} positions en ${fmtDec(r.ms / 1000, 1)} s · ${evalText(S, r)}`
      : 'L’attaquant explore l’arbre des coups possibles (minimax + alpha-bêta). Ses calculs s’afficheront ici.';
  }

  function render() {
    if (tab === 'chess') renderChessBoard(); else renderDamesBoard();
    renderPromo();
    renderPanel();
    const S = G();
    if (S.over && !S.reported) { S.reported = true; openReport(); }
  }

  /* ========================= COMPTE RENDU D'INCIDENT ========================= */
  function count(list) { const o = {}; for (const k of list) o[k] = (o[k] || 0) + 1; return o; }
  const countText = o => Object.entries(o).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');

  function buildReport(S) {
    const res = resultOf(S);
    const blue = S.hist.filter(h => h.blue), red = S.hist.filter(h => !h.blue);
    const summary = [];
    if (S === C) {
      const loc = red.filter(h => h.ev.detected).length;
      const pct = red.length ? Math.round(loc / red.length * 100) : 0;
      summary.push(`Mouvements adverses : ${red.length}, dont ${loc} localisés (${pct} %)`);
      const lost = count(red.filter(h => h.victim).map(h => Ops.role('blue', h.victim)));
      const evicted = count(blue.filter(h => h.victim).map(h => Ops.role('red', h.victim)));
      summary.push(`Pertes : ${Object.keys(lost).length ? countText(lost) : 'aucune'}`);
      summary.push(`Éléments adverses évincés : ${Object.keys(evicted).length ? countText(evicted) : 'aucun'}`);
    } else {
      const max = S.hist.reduce((t, h) => Math.max(t, h.threat), 0);
      summary.push(`Phase maximale atteinte par l’attaquant : ${max + 1}/7 · ${Ops.PHASES[max]}`);
      summary.push(`Compromissions (implants promus en dame) : ${red.filter(h => h.m.promo).length}`);
      summary.push(`Implants neutralisés : ${blue.reduce((n, h) => n + h.m.caps.length, 0)} · sentinelles perdues : ${red.reduce((n, h) => n + h.m.caps.length, 0)}`);
    }
    const tactics = count(blue.map(h => h.ev.tactic));
    const chronology = S.hist.map((h, i) => ({
      turn: turnOf(i), team: h.ev.team, text: h.ev.text,
      tag: h.ev.team === 'blue' ? Ops.TACTICS[h.ev.tactic].fr : (h.ev.alert ? 'Alerte' : 'Red'),
    }));
    return {
      theatre: THEATRE[S === C ? 'chess' : 'dames'], level: LEVEL_LABEL[S.level],
      result: res.title, why: res.why, cls: res.cls, turns: S.hist.length ? turnOf(S.hist.length - 1) : 0,
      date: new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }),
      summary, tactics, chronology,
    };
  }

  let lastReport = null;
  function openReport() {
    const S = G();
    if (!S.over) return;
    const r = lastReport = buildReport(S);
    const dlg = $('report');
    dlg.className = 'report ' + r.cls;
    $('report-title').textContent = r.result;
    $('report-why').textContent = r.why;
    const meta = $('report-meta');
    meta.replaceChildren();
    for (const [k, v] of [['Théâtre', r.theatre], ['Niveau de menace', r.level], ['Durée', `${r.turns} tour${r.turns > 1 ? 's' : ''}`], ['Date', r.date]]) {
      meta.append(el('dt', null, k), el('dd', null, v));
    }
    const sum = $('report-summary');
    sum.replaceChildren(...r.summary.map(s => el('li', null, s)), el('li', null, `Tactiques D3FEND employées : ${Ops.tacticsLine(r.tactics)}`));
    const chrono = $('report-chrono');
    chrono.replaceChildren(...S.hist.map((h, i) => eventItem(turnOf(i), h.ev)));
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }

  function closeReport() { const dlg = $('report'); if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); } }

  function downloadReport() {
    if (!lastReport) return;
    const blob = new Blob([Ops.reportText(lastReport)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = `compte-rendu-${tab === 'chess' ? 'echecs' : 'dames'}-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ================================ ÉVÉNEMENTS ================================ */
  boardEl.addEventListener('click', e => {
    const b = e.target.closest('button.sq');
    if (!b) return;
    const s = +b.dataset.s;
    if (tab === 'chess') chessClick(s); else damesClick(s);
    const again = boardEl.querySelector(`[data-s="${s}"]`);
    if (again && document.activeElement === document.body) again.focus({ preventScroll: true });
  });

  $('promo-cancel').addEventListener('click', () => { C.promo = null; C.sel = -1; render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && C.promo) { C.promo = null; render(); } });

  const newGame = human => { closeReport(); (tab === 'chess' ? chessNew : damesNew)(human); render(); };
  document.querySelectorAll('input[name="level"]').forEach(inp => inp.addEventListener('change', () => { G().level = inp.value; render(); }));
  $('new-white').addEventListener('click', () => newGame(1));
  $('new-black').addEventListener('click', () => newGame(-1));
  $('undo').addEventListener('click', () => (tab === 'chess' ? chessUndo : damesUndo)());
  $('open-report').addEventListener('click', openReport);
  $('report-close').addEventListener('click', closeReport);
  $('report-download').addEventListener('click', downloadReport);
  $('report-new').addEventListener('click', () => newGame(G().human));

  $('manual').addEventListener('submit', e => {
    e.preventDefault();
    const S = G(), msg = $('manual-msg'), input = $('manual-input');
    const raw = input.value.trim().slice(0, 20); // saisie bornée, jamais injectée en HTML
    msg.className = 'msg';
    if (!raw) { msg.textContent = ''; return; }
    if (!humanTurn(S)) { msg.classList.add('err'); msg.textContent = 'Attendez votre tour.'; return; }
    const res = S === C ? chessParse(raw) : damesParse(raw);
    if (res.err) { msg.classList.add('err'); msg.textContent = res.err; return; }
    input.value = '';
    msg.classList.add('ok');
    msg.textContent = 'Ordre transmis.';
    if (S === C) chessPlay(res.m); else damesPlay(res.m);
  });

  function route() {
    tab = location.hash === '#dames' ? 'dames' : 'chess';
    $('manual-msg').textContent = '';
    closeReport();
    render();
  }
  window.addEventListener('hashchange', route);

  /* ---------------- Démarrage (et reprise après republication) ---------------- */
  function snapshot() {
    return {
      tab,
      chess: { human: C.human, level: C.level, moves: C.hist.map(h => h.m) },
      dames: { human: D.human, level: D.level, moves: D.hist.map(h => ({ from: h.m.from, path: h.m.path })) },
    };
  }

  function start(data) {
    data = data || {};
    const c = data.chess || {}, d = data.dames || {};
    C.level = LEVEL_LABEL[c.level] ? c.level : 'club';
    D.level = LEVEL_LABEL[d.level] ? d.level : 'club';
    chessNew(c.human === -1 ? -1 : 1);
    damesNew(d.human === -1 ? -1 : 1);
    if (Array.isArray(c.moves) && c.moves.length) {
      cancelAI('chess'); C.thinking = false;
      for (const mv of c.moves) { const m = C.legal.find(x => x === mv); if (m === undefined || C.over) break; chessApply(m); }
    }
    if (Array.isArray(d.moves) && d.moves.length) {
      cancelAI('dames'); D.thinking = false;
      for (const mv of d.moves) { const m = D.legal.find(x => x.from === mv.from && x.path.join() === (mv.path || []).join()); if (!m || D.over) break; damesApply(m); }
    }
    route();
    if (!C.over && C.pos.side !== C.human && !C.thinking) chessAI();
    if (!D.over && D.pos.side !== D.human && !D.thinking) damesAI();
  }

  const hot = window.claude && window.claude.hot;
  if (hot && typeof hot.snapshot === 'function') hot.snapshot(snapshot);
  if (hot && typeof hot.ready === 'function') hot.ready(start); else start(hot && hot.data ? hot.data : {});
})();
